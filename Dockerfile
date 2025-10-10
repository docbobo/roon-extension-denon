FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S roon -u 1001 -G nodejs

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

# Install production dependencies only
RUN npm install --only=production && npm cache clean --force

# Bundle app source (exclude test files and coverage)
COPY --chown=roon:nodejs app.js ./
COPY --chown=roon:nodejs src/ ./src/
COPY --chown=roon:nodejs CLAUDE.md ./

# Switch to non-root user
USER roon

# Create volume for persistent data
VOLUME ["/usr/src/app/data"]

# Expose port if needed (Roon extensions typically don't need exposed ports)
# EXPOSE 3000

# Health check to ensure the extension is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD pgrep -f "node app.js" > /dev/null || exit 1

CMD [ "node", "app.js" ]
