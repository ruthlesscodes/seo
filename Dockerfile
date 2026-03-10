FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --production

COPY . .

# PORT set at runtime (e.g. Railway); server binds 0.0.0.0:PORT
EXPOSE 3000

CMD ["npm", "start"]
