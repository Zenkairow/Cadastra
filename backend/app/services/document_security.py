from typing import Optional, Dict

# File size limits per class in bytes
DOCUMENT_SIZE_LIMITS: Dict[str, int] = {
    "SALE_DEED": 25 * 1024 * 1024,      # 25 MB
    "7_12_EXTRACT": 25 * 1024 * 1024,   # 25 MB
    "TAX_RECEIPT": 25 * 1024 * 1024,    # 25 MB
    "SURVEY_MAP": 100 * 1024 * 1024,    # 100 MB
    "GIS_PACKAGE": 500 * 1024 * 1024,   # 500 MB
}

# Known file signature magic bytes
MAGIC_SIGNATURES = [
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
    (b"PK\x03\x04", "application/zip"),
]

def detect_mime_type_from_header(header_bytes: bytes) -> Optional[str]:
    """Inspects file leading bytes to determine canonical MIME type."""
    if not header_bytes:
        return None
    for sig, mime in MAGIC_SIGNATURES:
        if header_bytes.startswith(sig):
            return mime
    return None

def validate_document_security(header_bytes: bytes, claimed_mime: str, file_size: int, doc_type: str):
    """
    Validates:
    1. Document type is permitted.
    2. File size is within limits.
    3. File header magic bytes match allowed type and claimed MIME type.
    """
    doc_type_upper = doc_type.upper()
    if doc_type_upper not in DOCUMENT_SIZE_LIMITS:
        raise ValueError(f"Unsupported document type: {doc_type}. Must be one of {list(DOCUMENT_SIZE_LIMITS.keys())}")

    max_size = DOCUMENT_SIZE_LIMITS[doc_type_upper]
    if file_size > max_size:
        raise ValueError(f"File size {file_size} bytes exceeds maximum allowed limit {max_size} bytes for {doc_type}")

    actual_mime = detect_mime_type_from_header(header_bytes)
    if not actual_mime:
        raise ValueError("Unknown or unsupported binary file format. Magic bytes check failed.")

    # Prevent extension / MIME spoofing
    if claimed_mime and claimed_mime.lower() != actual_mime.lower():
        # Allow generic octet-stream only if actual mime is recognized
        if claimed_mime.lower() != "application/octet-stream":
            raise ValueError(f"MIME type spoofing detected: claimed '{claimed_mime}', but magic bytes identify '{actual_mime}'")

    return actual_mime

def sanitize_filename(filename: Optional[str]) -> str:
    """
    Sanitizes file names to prevent path traversal (OWASP Top 10),
    directory escapes, null-byte injection, and control character execution.
    """
    import os
    import re

    if not filename:
        return "unnamed_document"

    # 1. Strip directory paths
    base_name = os.path.basename(filename)

    # 2. Remove null bytes and path traversal patterns
    cleaned = re.sub(r'[\x00/\\?%*:|"<>]+', '', base_name)
    cleaned = cleaned.replace("..", "").replace(" ", "_").strip()

    # 3. Restrict length to 128 characters
    if len(cleaned) > 128:
        name_parts = cleaned.rsplit(".", 1)
        if len(name_parts) == 2:
            cleaned = name_parts[0][:120] + "." + name_parts[1]
        else:
            cleaned = cleaned[:128]

    return cleaned if cleaned else "sanitized_document"

