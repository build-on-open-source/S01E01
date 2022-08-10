FROM python:3-alpine
WORKDIR /usr/src/app
RUN adduser -D worker -u 10001
USER worker
EXPOSE 8080
ENV PATH="/home/worker/.local/bin:${PATH}"
#RUN pip install pipenv
COPY requirements.txt requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt
#COPY --chown=worker:worker Pipfile .
#COPY --chown=worker:worker Pipfile.lock .
# RUN pipenv install --ignore-pipfile --system --deploy 
COPY --chown=worker:worker server.py .
CMD ["python", "./server.py"]
