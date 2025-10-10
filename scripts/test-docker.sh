#!/bin/bash

# Test script for Docker functionality
set -e

echo "🐳 Testing Docker build and functionality..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not available in PATH"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo "❌ Docker daemon is not running"
    exit 1
fi

echo "✅ Docker is available and running"

# Build the image
echo "🔨 Building Docker image..."
docker build -t roon-extension-denon:test .

# Test basic functionality
echo "🧪 Testing container startup..."
CONTAINER_ID=$(docker run -d --name roon-extension-test roon-extension-denon:test)

# Wait a moment for startup
sleep 5

# Check if container is running
if docker ps | grep -q roon-extension-test; then
    echo "✅ Container started successfully"
else
    echo "❌ Container failed to start"
    docker logs roon-extension-test
    exit 1
fi

# Check health
echo "🏥 Checking container health..."
HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' roon-extension-test 2>/dev/null || echo "no-health-check")

if [ "$HEALTH_STATUS" = "healthy" ] || [ "$HEALTH_STATUS" = "no-health-check" ]; then
    echo "✅ Container is healthy"
else
    echo "⚠️  Container health status: $HEALTH_STATUS"
fi

# Show logs
echo "📋 Container logs:"
docker logs roon-extension-test

# Cleanup
echo "🧹 Cleaning up test container..."
docker stop roon-extension-test
docker rm roon-extension-test

echo "✅ Docker build test completed successfully!"