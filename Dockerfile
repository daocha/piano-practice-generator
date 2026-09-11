FROM node:20-alpine

# openssl is needed only if you run the server with --https (self-signed cert)
RUN apk add --no-cache openssl

WORKDIR /app
COPY . .

ENV PORT=6010
EXPOSE 6010

CMD ["node", "server.js"]
