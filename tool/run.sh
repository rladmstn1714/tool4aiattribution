#!/bin/bash
folder_name=$1
if [ "$2" = "--port" ]; then
  port=${3:-5173}
else
  port=${2:-5173}
fi
cd "$(dirname "$0")"
if [ -n "$folder_name" ]; then
  VITE_DATA_BASE=$folder_name npm run dev -- --port "$port"
else
  npm run dev -- --port "$port"
fi