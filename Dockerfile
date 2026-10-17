# Shed! — one small Bun process: static files + WebSocket rooms on $PORT.
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json server.ts ./
COPY public ./public
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER bun
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.ts"]
