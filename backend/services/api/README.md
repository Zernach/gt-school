# API service

Choose the API language and framework for this project. The initial Compose
configuration runs a neutral HTTP placeholder image so the infrastructure stack
is usable immediately.

When ready, add the API source and Dockerfile here, then commit the API's
`build: ../services/api` configuration in `../../docker/compose.yaml` alongside
that source. Set the listening port with `API_CONTAINER_PORT` in
`../../docker/.env`.

`../../docker/compose.local.yaml` is only for developer-machine adjustments,
such as publishing internal service ports or adding a debugger. The shared
Compose file deliberately supplies connection settings, but does not impose an
API language, framework, package manager, or build system.
