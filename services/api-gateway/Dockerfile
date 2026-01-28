FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY shared/ ./shared/
COPY services/api-gateway/ ./services/api-gateway/

CMD ["node", "services/api-gateway/index.js"]
