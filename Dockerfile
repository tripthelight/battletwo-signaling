FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY src ./src

ENV RTC_HOST=0.0.0.0
ENV RTC_PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const net=require('net'); const s=net.connect(5000,'127.0.0.1',()=>{s.end();process.exit(0)}); s.on('error',()=>process.exit(1)); setTimeout(()=>process.exit(1),2000);"

USER node

CMD ["npm", "start"]