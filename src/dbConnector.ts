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
        this.createTables();
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

    private createTables() {
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATETIME NOT NULL,
                question TEXT NOT NULL,
                solution TEXT NOT NULL,
                closestAnswer TEXT NOT NULL,
                winner TEXT NOT NULL
            )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
                ROUND(MAX(0, (1 - ABS((CAST(closestAnswer AS REAL) - CAST(solution AS REAL)) / CAST(solution AS REAL))) * 100), 1) AS percentage
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

    public getWinnerRanking() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT
                    winner,
                    COUNT(*) as count,
                    RANK() OVER (ORDER BY COUNT(*) DESC) as rank
                FROM questions
                GROUP BY winner
                ORDER BY rank
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

    public setConfig(key: string, value: string) {
        this.db.serialize(() => {
            this.db.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`, [key, value], (err) => {
                if (err) {
                    errWithTime(err.message);
                }
            });
        });
    }

    public getConfig(): Promise<{ key: string, value: string }[]> {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT * FROM config`, (err, rows: { key: string; value: string }[]) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}