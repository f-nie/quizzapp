import { exec } from 'child_process';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { Server } from "socket.io";
import { DbConnector } from './dbConnector';
import { errWithTime, logWithTime } from './util';

type Answer = {
    rank: number;
    name: string;
    answer: number;
    deviation: number;
    percentage: number;
    time: number;
}
export class QuizzServer {

    // constants
    private port = 3000;

    // runtime variables
    private app: express.Application;
    private httpServer: ReturnType<typeof createServer>;
    private socketServer: Server;
    private dbConnector: DbConnector;

    // app variables
    private answers = new Map<string, number[]>();    // key: name, value: [answer, timestamp]
    private sortedAnswers: Answer[] = [];
    private question: string = "";
    private solution: number = 0;
    private questionTimestamp: number = 0;
    private isClosed: boolean = false;
    private hostSubscriberId: string = "";


    constructor(dbConnector: DbConnector) {
        this.dbConnector = dbConnector;
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

    private basicAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Host Access"');
            res.status(401).send('Authentication required');
            return;
        }
        
        try {
            const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf-8');
            const [username, password] = credentials.split(':');
            
            const expectedUser = process.env.HOST_USERNAME || 'admin';
            const expectedPass = process.env.HOST_PASSWORD || 'admin';
            
            if (username === expectedUser && password === expectedPass) {
                next();
            } else {
                res.setHeader('WWW-Authenticate', 'Basic realm="Host Access"');
                res.status(401).send('Invalid credentials');
            }
        } catch (error) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Host Access"');
            res.status(401).send('Invalid credentials');
        }
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

        this.app.get('/host', this.basicAuth.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web', 'host.html'));
        });

        this.app.get('/statistics', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web', 'statistics.html'));
        });

        this.app.get('/icon.png', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'web/images', 'icon.png'));
        });

        // host services

        this.app.post('/newQuestion', this.basicAuth.bind(this), (req, res) => {
            this.setNewQuestion(req.body.question, req.body.answer);
            this.isClosed = false;
            this.socketServer.emit('isClosed', false);
            this.socketServer.emit('newQuestion', this.question);
            res.send('New question set');
        });

        this.app.get('/closeQuestion', this.basicAuth.bind(this), (req, res) => {
            this.isClosed = true;
            this.socketServer.emit('isClosed', true);
            res.json(this.sortedAnswers);
        });

        this.app.get('/getAnswers', this.basicAuth.bind(this), (req, res) => {         // service for answer polling is implemented as a redunandancy to the unreliable socket.io connection
            const hostId = req.query.hostId as string;
            if (hostId !== this.hostSubscriberId) {
                res.status(403).send('Forbidden');
                return;
            }
            res.json(this.sortedAnswers);
        });

        this.app.get('/revealResult', this.basicAuth.bind(this), (req, res) => {
            this.socketServer.emit('results', {
                solution: this.solution,
                ranking: this.sortedAnswers
            });
            this.storeWinner();
            res.send('Result revealed');
        });

        this.app.get('/clearQuestion', this.basicAuth.bind(this), (req, res) => {
            this.clearQuestion();
            this.socketServer.emit('newQuestion', this.question);
            res.send('Question cleared');
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
            this.answers.set(name, [parsedAnswer, Date.now()]);
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
        this.questionTimestamp = 0;
        this.isClosed = false;
        this.sortedAnswers = [];
        this.answers.clear();
    }

    private setNewQuestion(question: string, answer: number) {
        this.clearQuestion();
        this.question = question;
        this.solution = answer;
        this.questionTimestamp = Date.now();
    }

    private calculateRanking() {
        this.sortedAnswers = Array.from(this.answers.entries()).map(([name, value]): Answer => {
            const deviation = parseFloat(Math.abs(value[0] - this.solution).toFixed(2));
            const percentage = Math.max(0, parseFloat(((1 - Math.abs((value[0] - this.solution) / this.solution)) * 100).toFixed(1)));
            const time = (value[1] - this.questionTimestamp) / 1000;
            return {
            rank: 0,
            name: name,
            answer: value[0],
            deviation: deviation,
            percentage: percentage,
            time: time
            };
        }).sort((a, b) => a.deviation === b.deviation ? a.time - b.time : a.deviation - b.deviation);

        this.sortedAnswers.forEach((answer, index) => {
            answer.rank = index + 1;
        });
    }

    private storeWinner() {
        this.calculateRanking();
        if (this.sortedAnswers.length === 0) {
            return;
        }
        const winner = this.sortedAnswers[0].name;
        const closestAnswer = this.sortedAnswers[0].answer;
        this.dbConnector.insertQuestion(new Date().toISOString(), this.question, this.solution.toString(), closestAnswer.toString(), winner);
				this.dbConnector.updateWinnerBookToMaggus();
    }

    private getWinnerRanking() {
        return this.dbConnector.getWinnerRanking();
    }

    private getAllQuestions() {
        return this.dbConnector.getQuestions();
    }
}
