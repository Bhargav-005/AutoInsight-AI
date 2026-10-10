from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry
from rq import Queue
from rq.serializers import JSONSerializer

from app.core.config import Settings


def redis_connection(settings: Settings) -> Redis:
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password.get_secret_value(),
        socket_connect_timeout=2,
        socket_timeout=2,
        retry=Retry(NoBackoff(), 0),
    )


def queue(settings: Settings, connection: Redis) -> Queue:
    return Queue(
        settings.rq_queue,
        connection=connection,
        serializer=JSONSerializer,
        default_timeout=settings.max_job_seconds,
    )
