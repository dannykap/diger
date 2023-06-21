FILE=./tsconfig.json

if [ -f "$FILE" ]; then
  $(dirname "$0")/nld-ts.js "$@"
else
  $(dirname "$0")/nld-js.js "$@"
fi