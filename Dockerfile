FROM node as ircserv_dependencies
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

FROM ircserv_dependencies as ircserv_tests
COPY lib lib/
COPY index.js ./
COPY bin bin/
COPY server.js ./
COPY config config/
COPY .eslintrc.json ./
COPY .eslintignore ./
# test cannot start tcp server? run tests with `npm test`
# COPY test test/
RUN npm run lint

FROM ircserv_tests as ircserv
COPY lib/ lib/
COPY index.js ./
COPY server.js ./
CMD npm start
