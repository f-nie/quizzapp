# quizzapp

Gravity Quiz App for number estimation questions. It shows a question to multiple players and lets them provide their estimation. A ranking of all answers is created and each winner (in case of a tie, the first answer wins) is stored in a database for statistics.

## How to run
### In a docker container
- Create docker image:  ```./build.sh```
	- Optional: set the environment variable QUIZZAPP_IMAGE_REPOSITORY to use a custom tag for the image and automatically push the image to the provided container registry
- Either:
    - Use ```compose.yaml``` to automatically create and link a Docker volume for persistency and run the container
    - Manually
        - Create volume: ```docker volume create quizzapp_db```
        - Run container: ```docker run -d -p 3000:3000 --name quizzapp-container -v quizzapp_db:/app/db quizzapp```


### Locally
#### Prerequisites
- Install node.js including npm (see platform specific documentation on [Node.js website](https://nodejs.org/en/download)).
- Install ts-node to be able to execute Typescript files: ```npm install -g ts-node```

#### Install dependencies
- Run ```npm install```

#### Start app
- Run ```ts-node src/start.ts```
- ```./start.sh``` starts the app and writes all output into ```logs.log```file

## UIs
- Host UI: http://localhost:3000/host
- Player UI: http://localhost:3000/player
- Listing of question history: http://localhost:3000/statistics

## AI question generation
The host UI features a button to generate quiz questions via the Gemini API. To enable it, a valid API key must be provided.

Get an API key at [aistudio.google.com](https://aistudio.google.com).

### Docker deployment
Create a `.env` file next to `compose.yaml`:
```
GEMINI_API_KEY=your-api-key-here
```
The key is passed to the container via the `environment` section in `compose.yaml`. Without it, the AI button is disabled.

### Local setup
Set the environment variable before starting the app:
```sh
GEMINI_API_KEY=your-api-key-here ts-node src/start.ts
```

## How to manually add an entry to the database

```sh
ts-node src/addWinner.ts <date> <question> <solution> <closest answer> <winner>
```

e.g.

```sh
ts-node src/addWinner.ts "31.12.2024" "How many days did this year have?" 366 365 Martina
```
