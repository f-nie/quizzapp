import { exec } from 'child_process';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { Server } from "socket.io";
import { DbConnector } from './dbConnector';
import { GeminiConnector } from './geminiConnector';
import { errWithTime, logWithTime } from './util';

export class QuizzServer {

    // constants
    private port = 3000;

    // runtime variables
    private app: express.Application;
    private httpServer: ReturnType<typeof createServer>;
    private socketServer: Server;
    private dbConnector: DbConnector;
    private geminiConnector: GeminiConnector;;

    // app variables
    private answers = new Map<string, number>();                // key: name, value: answer
    private sortedAnswers: [string, number, number][] = [];     // [name, answer, distance]
    private question: string = "";
    private solution: number = 0;
    private isClosed: boolean = false;
    private hostSubscriberId: string = "";


    constructor(dbConnector: DbConnector, geminiConnector: GeminiConnector) {
        this.dbConnector = dbConnector;
        this.geminiConnector = geminiConnector;
        this.app = express();
        this.httpServer = createServer(this.app);
        this.socketServer = new Server(this.httpServer);
        this.socketServer.on('connection', (socket) => {
            socket.on('subscribe', (topic) => {
                socket.join(topic);
                this.hostSubscriberId = topic;
            });
            socket.on('unsubscribe', (topic) => {
                socket.leave(topic);
                this.hostSubscriberId = "";
            });
        });
    }

    public start() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '..', 'web')));

        this.httpServer.listen(this.port, () => {
            logWithTime(`Server is running at http://localhost:${this.port}`);
        });

        // client pages

        this.app.get('/player', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web', 'player.html'));
        });

        this.app.get('/host', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web', 'host.html'));
        });

        this.app.get('/statistics', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web', 'statistics.html'));
        });

        this.app.get('/icon.png', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web/images', 'icon.png'));
        });

        // host services

        this.app.post('/newQuestion', (req, res) => {
            this.setNewQuestion(req.body.question, req.body.answer);
            this.isClosed = false;
            this.socketServer.emit('isClosed', false);
            this.socketServer.emit('newQuestion', this.question);
            res.send('New question set');
        });

        this.app.get('/closeQuestion', (req, res) => {
            this.isClosed = true;
            this.socketServer.emit('isClosed', true);
            res.json('Question closed');
        });

        this.app.get('/revealResult', (req, res) => {
            this.socketServer.emit('results', {
                solution: this.solution,
                ranking: this.sortedAnswers
            });
            this.storeWinner();
            res.send('Result revealed');
        });

        this.app.get('/clearQuestion', (req, res) => {
            this.clearQuestion();
            this.socketServer.emit('newQuestion', this.question);
            res.send('Question cleared');
        });

        this.app.get('/getAIQuestion', (req, res) => {
            this.geminiConnector.generateQuestion().then(result => {
                res.json(result);
            })
        });

        this.app.get('/isAIReady', (req, res) => {
            this.geminiConnector.IsUp() ? res.send('AI is ready') : res.status(500).send('AI is not ready');
        });

        this.app.post('/setConfig', (req, res) => {
            const { key, value } = req.body;
            this.dbConnector.setConfig(key, value);
            res.send('Configuration updated');
        });

        this.app.get('/getConfig', (req, res) => {
            this.dbConnector.getConfig().then(result => {
                res.json(result);
            })
        });

        // player services

        this.app.get('/getQuestion', (req, res) => {
            res.json({
                question: this.question,
                isClosed: this.isClosed     // required to retrieve state when loading player ui
            });
        });

        this.app.post('/addAnswer', (req, res) => {
            if (this.isClosed) {
                res.status(400).send('Question is closed');
                return;
            }
            const { name, answer } = req.body;
            const parsedAnswer = parseFloat(answer);
            if (isNaN(parsedAnswer)) {
                res.status(400).send('Invalid answer');
                return;
            }
            this.answers.set(name, parsedAnswer);
            this.calculateRanking();
            this.socketServer.to(this.hostSubscriberId).emit('newAnswer', this.sortedAnswers);
            res.send('Answer added');
        });

        // statistics services

        this.app.get('/getWinnerRanking', (req, res) => {
            this.getWinnerRanking().then(result => {
                res.json(result);
            }).catch(error => {
                res.status(500).send(error.message);
                errWithTime(error.message);
            });
        });

        this.app.get('/getAllQuestions', (req, res) => {
            this.getAllQuestions().then(result => {
                res.json(result);
            }).catch(error => {
                res.status(500).send(error.message);
                errWithTime(error.message);
            });
        });

        // debugging services

        this.app.get('/logs', (req, res) => {
            exec('tail -n 100 db/logs.log', (error, stdout, stderr) => {
                if (error) {
                    res.status(500).send(`Error: ${error.message}`);
                    errWithTime(error.message);
                    return;
                }
                if (stderr) {
                    res.status(500).send(`Stderr: ${stderr}`);
                    errWithTime(stderr);
                    return;
                }
                res.send(`<pre>${stdout}</pre>`);
            });
        });
    }

    private clearQuestion() {
        this.question = "";
        this.solution = 0;
        this.isClosed = false;
        this.sortedAnswers = [];
        this.answers.clear();
    }

    private setNewQuestion(question: string, answer: number) {
        this.clearQuestion();
        this.question = question;
        this.solution = answer;
    }

    private calculateRanking() {
        this.sortedAnswers = Array.from(this.answers.entries()).map(([name, value]): [string, number, number] => {
            return [name, value, parseFloat(Math.abs(value - this.solution).toFixed(2))];
        }).sort((a, b) => a[2] - b[2]);
    }

    private storeWinner() {
        this.calculateRanking();
        if (this.sortedAnswers.length === 0) {
            return;
        }
        const winner = this.sortedAnswers[0][0];
        this.dbConnector.insertQuestion(new Date().toISOString(), this.question, this.solution.toString(), this.sortedAnswers[0][1].toString(), winner);
    }

    private getWinnerRanking() {
        return this.dbConnector.getWinnerRanking();
    }

    private getAllQuestions() {
        return this.dbConnector.getQuestions();
    }
}