# demo samples

- **clip**: "Customers in a minimalist style restaurant", Mixkit (https://mixkit.co/free-stock-video/customers-in-a-minimalist-style-restaurant-4385/), free under the Mixkit License. The raw clip is not stored here: the Docker build downloads it and checks its sha-256.
- **zones-mixkit-4385.json**: where the three visible tables are (tables n°1, 3 and 4 of the demo restaurant), plus the privacy masks (the far end of the room and the aisle, always blurred), and each tabletop outline (only drawn on the video). Same format as the api's camera config.
- **timeline.json**: the table readings produced by `python -m resto_vision render` on that clip. The blurred result and this timeline are served by the frontend in `client/public/monitoring/` for the public demo.

To re-render the demo assets:

```bash
curl -L -o samples/mixkit-4385.mp4 https://assets.mixkit.co/videos/4385/4385-720.mp4
OCCUPIED_AFTER=0.5 EMPTY_AFTER=1.5 COUNT_WINDOW=1.0 python -m resto_vision render \
  --input samples/mixkit-4385.mp4 --zones samples/zones-mixkit-4385.json \
  --out samples/demo-raw.mp4 --timeline samples/timeline.json
ffmpeg -i samples/demo-raw.mp4 -c:v libx264 -crf 28 -vf scale=960:-2 -pix_fmt yuv420p -movflags +faststart -an \
  ../client/public/monitoring/demo.mp4 && cp samples/timeline.json ../client/public/monitoring/
```

The short delays (`OCCUPIED_AFTER=0.5`…) fit this time-lapse clip; a real camera uses the defaults (4 s to become occupied, 20 s to become empty).
