# Testbed build of ../battleofgeniuses/survival-server.
#
# Why not the service's own dev.Dockerfile?
#   * survival-server has no .dockerignore, so its `COPY . .` would drag a
#     host-built (darwin/arm64) node_modules into the image and break the
#     native `grpc` addon. We copy only sources.
#   * `yarn watch` starts nodemon on dist/server.js before babel has produced
#     it. We build once, then run.
#   * `yarn prod-build` runs `tsc --noEmit` first; survival-server's sources are
#     being edited right now, so a type error would block the whole testbed.
#     Babel strips types without checking, which is what we want here.
FROM node:12.14-alpine

WORKDIR /home/server

RUN apk update && apk add --no-cache git python make g++

COPY package.json yarn.lock ./
# --ignore-engines is required: a transitive dep (node-releases@2.0.51, pulled in
# by @babel/preset-env -> browserslist) declares engines.node >= 18 and yarn
# aborts the whole install on node 12.14 without it.
RUN yarn install --ignore-engines

COPY tsconfig.json .babelrc ./
COPY src ./src

# survival-server resolves its protos at runtime as
# path.join(__dirname, '../src/proto/*.proto'), i.e. /home/server/src/proto —
# keep src/ in the image, do not build into a scratch stage.
CMD ["sh", "-c", "yarn build-ts && node dist/server.js"]
