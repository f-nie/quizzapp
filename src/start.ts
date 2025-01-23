import { DbConnector } from "./dbConnector";
import { GeminiConnector } from "./geminiConnector";
import { QuizzServer } from "./server";
import { logWithTime } from "./util";

const dbConnector = new DbConnector();
const geminiConnector = new GeminiConnector(dbConnector);
const server = new QuizzServer(dbConnector, geminiConnector);
server.start();

process.on("SIGINT", function () {
  logWithTime("Stopping application...");
  dbConnector.closeDbConnection();
  process.exit();
});