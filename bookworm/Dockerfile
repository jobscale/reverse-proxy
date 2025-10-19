FROM node:lts-bookworm-slim
WORKDIR /home/node
USER node
COPY --chown=node:staff package.json .
RUN npm i --omit=dev
COPY --chown=node:staff docs docs
COPY --chown=node:staff app app
COPY --chown=node:staff index.js .
EXPOSE 3000
CMD ["npm", "start"]
