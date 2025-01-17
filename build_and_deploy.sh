#!/bin/sh

echo "Building docker image..."
docker build . --file Dockerfile --tag docker.io/jcharr1/roon-extension-denon:latest

echo "Pushing to Docker Hub..."
docker push docker.io/jcharr1/roon-extension-denon:latest