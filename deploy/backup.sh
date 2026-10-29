#!/bin/sh
# Daily backup: the database (pg_dump custom format) and the uploaded photos (media).
# Files land in ./backups on the server; copy that folder off the server too (see docs/DEPLOIEMENT.md).
# Restore: docs/DEPLOIEMENT.md, "Restaurer une sauvegarde".
while true; do
  stamp=$(date +%Y-%m-%d-%H%M)
  if pg_dump -Fc -f "/backups/resto-$stamp.dump" && tar czf "/backups/media-$stamp.tgz" -C /media .; then
    echo "backup $stamp ok"
  else
    echo "backup $stamp FAILED"
  fi
  find /backups -type f -mtime +"${KEEP_DAYS:-14}" -delete  # keep two weeks
  sleep 86400
done
