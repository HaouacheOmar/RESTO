FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN SECRET_KEY=build DEBUG=0 python manage.py collectstatic --noinput

EXPOSE 8000
# demo data (public demo accounts!) unless SEED_DEMO=0, as in production. seed_demo only creates
# what is missing, so it is safe on every start
CMD ["sh", "-c", "python manage.py migrate --noinput && if [ ${SEED_DEMO:-1} = 1 ]; then python manage.py seed_demo && python manage.py seed_monitoring; fi && daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application"]
