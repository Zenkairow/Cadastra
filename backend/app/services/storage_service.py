import os
import hashlib
import io
from pathlib import Path
from typing import BinaryIO, Generator, Optional, Dict, Any, Union
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from backend.app.config import settings

def compute_stream_sha256(stream_or_bytes: Union[BinaryIO, bytes, io.BytesIO], chunk_size: int = 65536) -> str:
    """
    Computes SHA-256 hash in constant O(1) memory buffer.
    Never loads large files entirely into RAM.
    Returns 0x-prefixed hex string.
    """
    hasher = hashlib.sha256()

    if isinstance(stream_or_bytes, bytes):
        hasher.update(stream_or_bytes)
        return "0x" + hasher.hexdigest()

    # If file or stream
    current_pos = None
    try:
        current_pos = stream_or_bytes.tell()
    except Exception:
        pass

    while True:
        chunk = stream_or_bytes.read(chunk_size)
        if not chunk:
            break
        hasher.update(chunk)

    if current_pos is not None:
        try:
            stream_or_bytes.seek(current_pos)
        except Exception:
            pass

    return "0x" + hasher.hexdigest()

class StorageService:
    """
    Unified storage abstraction supporting local filesystem and S3/MinIO
    with streaming constant-memory uploads, downloads, and presigned URLs.
    """
    def __init__(self):
        self.storage_type = settings.STORAGE_TYPE.lower()
        self.local_root = Path(settings.STORAGE_LOCAL_ROOT).resolve()
        self.bucket = settings.MINIO_BUCKET
        self.s3_client = None

        if self.storage_type in ("minio", "s3"):
            try:
                self.s3_client = boto3.client(
                    "s3",
                    endpoint_url=settings.MINIO_ENDPOINT,
                    aws_access_key_id=settings.MINIO_ACCESS_KEY,
                    aws_secret_access_key=settings.MINIO_SECRET_KEY,
                    config=Config(signature_version="s3v4"),
                    region_name="us-east-1"
                )
                # Ensure bucket exists
                try:
                    self.s3_client.head_bucket(Bucket=self.bucket)
                except ClientError:
                    try:
                        self.s3_client.create_bucket(Bucket=self.bucket)
                    except Exception:
                        pass
            except Exception:
                # Fallback to local if MinIO connection fails
                self.storage_type = "local"

        if self.storage_type == "local":
            self.local_root.mkdir(parents=True, exist_ok=True)

    def put_object(self, key: str, data: Union[bytes, BinaryIO], content_type: str = "application/octet-stream") -> Dict[str, Any]:
        """Uploads an object and returns metadata."""
        if isinstance(data, bytes):
            data_stream = io.BytesIO(data)
            size = len(data)
        else:
            data_stream = data
            try:
                current_pos = data_stream.tell()
                data_stream.seek(0, os.SEEK_END)
                size = data_stream.tell()
                data_stream.seek(current_pos)
            except Exception:
                size = -1

        if self.storage_type in ("minio", "s3") and self.s3_client:
            self.s3_client.upload_fileobj(
                Fileobj=data_stream,
                Bucket=self.bucket,
                Key=key,
                ExtraArgs={"ContentType": content_type}
            )
            return {"storage": "s3", "key": key, "size": size, "content_type": content_type}
        else:
            # Local filesystem
            target_path = self.local_root / key
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with open(target_path, "wb") as f:
                if isinstance(data, bytes):
                    f.write(data)
                else:
                    while True:
                        chunk = data_stream.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
            return {"storage": "local", "key": key, "size": target_path.stat().st_size, "content_type": content_type}

    def get_object_stream(self, key: str) -> BinaryIO:
        """Returns a readable binary stream for the object."""
        if self.storage_type in ("minio", "s3") and self.s3_client:
            response = self.s3_client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"]
        else:
            target_path = self.local_root / key
            if not target_path.exists():
                raise FileNotFoundError(f"Stored file '{key}' does not exist.")
            return open(target_path, "rb")

    def get_object_bytes(self, key: str) -> bytes:
        """Reads entire object into bytes."""
        stream = self.get_object_stream(key)
        try:
            return stream.read()
        finally:
            if hasattr(stream, "close"):
                stream.close()

    def object_exists(self, key: str) -> bool:
        if self.storage_type in ("minio", "s3") and self.s3_client:
            try:
                self.s3_client.head_object(Bucket=self.bucket, Key=key)
                return True
            except ClientError:
                return False
        else:
            return (self.local_root / key).exists()

    def delete_object(self, key: str):
        if self.storage_type in ("minio", "s3") and self.s3_client:
            try:
                self.s3_client.delete_object(Bucket=self.bucket, Key=key)
            except ClientError:
                pass
        else:
            p = self.local_root / key
            if p.exists():
                p.unlink()

    def generate_presigned_download_url(self, key: str, expires_in: int = 900) -> str:
        """Generates a short-lived download URL."""
        if self.storage_type in ("minio", "s3") and self.s3_client:
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_in
            )
        else:
            # For local dev / testing, return an authorized internal route pointer
            return f"/api/v1/documents/raw/{key}?expires_in={expires_in}"

storage_service = StorageService()
