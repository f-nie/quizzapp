import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { errWithTime, logWithTime } from './util';

export class DbConnector {
    private db: sqlite3.Database;

    constructor() {
        const dbDir = path.join(__dirname, '..', 'db');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir);
        }
        this.db = new sqlite3.Database('db/quizzapp.db', (err) => {
            if (err) {
                errWithTime(err.message);
            }
            else {
                logWithTime('Connected to the quizzapp database.');
            }
        });
        this.createTable();
    }

    public closeDbConnection() {
        this.db.close((err) => {
            if (err) {
                errWithTime(err.message);
            }
            else {
                logWithTime('Connection to the quizzapp database closed.');
            }
        });
    }

    private createTable() {
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATETIME NOT NULL,
                question TEXT NOT NULL,
                solution TEXT NOT NULL,
                closestAnswer TEXT NOT NULL,
                winner TEXT NOT NULL
            )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS ai_suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATETIME NOT NULL,
                question TEXT NOT NULL
            )`);
        });
    }

    public insertQuestion(date: string, question: string, solution: string, closestAnswer: string, winner: string) {
        this.db.serialize(() => {
            this.db.run(`INSERT INTO questions (date, question, solution, closestAnswer, winner) VALUES (?, ?, ?, ?, ?)`, [date, question, solution, closestAnswer, winner], (err) => {
                if (err) {
                    errWithTime(err.message);
                }
            });
        });
    }

    public getQuestions() {
        return new Promise((resolve, reject) => {
        const query = `
            SELECT *,
            CASE
                WHEN CAST(solution AS REAL) = 0 THEN
                    CASE
                        WHEN CAST(closestAnswer AS REAL) = 0 THEN 100
                        ELSE 0
                    END
                ELSE
                    ROUND(MAX(0, (1 - ABS((CAST(closestAnswer AS REAL) - CAST(solution AS REAL)) / CAST(solution AS REAL))) * 100), 1)
            END AS percentage
            FROM questions
            ORDER BY date DESC
        `;
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    public insertAiSuggestion(question: string) {
        this.db.serialize(() => {
            this.db.run(
                `INSERT INTO ai_suggestions (date, question) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM ai_suggestions WHERE question = ?)`,
                [new Date().toISOString(), question, question],
                (err) => { if (err) errWithTime(err.message); }
            );
        });
    }

    public getRecentAiSuggestions(limit: number): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT question FROM ai_suggestions ORDER BY id DESC LIMIT ?`, [limit], (err, rows: { question: string }[]) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.question));
            });
        });
    }

    public updateWinnerBookToMaggus() {        return new Promise((resolve, reject) => {
            const query = `
              UPDATE questions
              SET winner = 'Maggus'
              WHERE LOWER(winner) LIKE 'book%' OR LOWER(winner) LIKE 'magg%'
            `;
            this.db.run(query, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}
