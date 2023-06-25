FILE=./tsconfig.json

if [ -f "$FILE" ]; then
  $(dirname "$0")/nld-ts  "$@"
else
  $(dirname "$0")/nld-js "$@"
fi