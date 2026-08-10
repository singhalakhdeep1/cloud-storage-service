FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build --if-present
EXPOSE 3000
CMD ["npm", "run", "start", "--if-present"]
