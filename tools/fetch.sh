q(){ # file query ; retries on both mirrors
  for t in 1 2 3 4 5 6; do
    for E in https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter; do
      curl -s --max-time 290 -A "DakarDriveGame/1.0 (personal project)" -o "$1.tmp" --data-urlencode "data=$2" $E
      if head -c 30 "$1.tmp" 2>/dev/null | grep -q '{'; then mv "$1.tmp" "$1"; echo "$1 OK $(wc -c < $1) via $E"; return; fi
      echo "$1 fail via $E: $(head -c 120 $1.tmp 2>/dev/null | tr -d '\n')"; sleep 15
    done
  done
}
