import dotenv from 'dotenv';
import { DbConnector } from "./dbConnector";
import { QuizzServer } from "./server";
import { logWithTime } from "./util";

// Load environment variables from .env file
dotenv.config();

const dbConnector = new DbConnector();
const server = new QuizzServer(dbConnector);
server.start();

process.on("SIGINT", function () {
  logWithTime("Stopping application...");
  dbConnector.closeDbConnection();
  process.exit();
});