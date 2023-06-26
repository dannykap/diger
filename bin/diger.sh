FILE=./tsconfig.json

if [ -f "$FILE" ]; then
  $(dirname "$0")/diger-ts  "$@"
else
  $(dirname "$0")/diger-js "$@"
fi