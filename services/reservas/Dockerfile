FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY shared/ ./shared/
COPY services/reservas/ ./services/reservas/

CMD ["node", "services/reservas/index.js"]
