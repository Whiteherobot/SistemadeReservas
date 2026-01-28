FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000 3001 3002 3003 3004

CMD ["node", "start.js"]
