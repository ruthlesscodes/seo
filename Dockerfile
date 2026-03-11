FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --production

COPY . .

# Railway sets PORT at runtime; app binds 0.0.0.0:PORT
EXPOSE 8080

CMD ["node", "src/index.js"]
