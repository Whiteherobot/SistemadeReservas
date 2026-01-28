FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY shared/ ./shared/
COPY services/notificaciones/ ./services/notificaciones/

CMD ["node", "services/notificaciones/index.js"]
