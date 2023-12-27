#!/bin/sh

echo "Building docker image..."
/usr/local/bin/docker build . --file Dockerfile --tag docker.io/jcharr1/roon-extension-denon:latest

echo "Pushing to Docker Hub..."
/usr/local/bin/docker push docker.io/jcharr1/roon-extension-denon:latest