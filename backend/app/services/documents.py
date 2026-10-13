"""Bounded, deterministic extraction and chunking for selectable-text references."""

import io
import re
import unicodedata
import zipfile
from pathlib import PurePath

from docx import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader


class DocumentProcessingError(ValueError):
    """A safe, user-displayable document validation or extraction failure."""


def validate_document_upload(data: bytes, filename: str, settings) -> str:
    """Check declared suffix against inexpensive container/signature checks."""
    suffix = PurePath(filename).suffix.casefold()
    if not data or len(data) > settings.max_document_bytes:
        raise DocumentProcessingError("The document is empty or exceeds the upload size limit.")
    if suffix == ".pdf" and data.startswith(b"%PDF-"):
        return "application/pdf"
    if suffix == ".docx" and data.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
                total_size = sum(info.file_size for info in archive.infolist())
                if (
                    "[Content_Types].xml" in names
                    and "word/document.xml" in names
                    and len(names) <= 10_000
                    and total_size <= settings.max_document_text_bytes * 4
                ):
                    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        except (OSError, zipfile.BadZipFile):
            pass
        raise DocumentProcessingError("The selected DOCX file is corrupt or invalid.")
    if suffix == ".txt" and not data.startswith((b"%PDF-", b"PK\x03\x04")):
        for encoding in ("utf-8-sig", "utf-16", "cp1252"):
            try:
                text = data.decode(encoding, errors="strict")
                if text.count("\x00") <= max(1, len(text) // 100):
                    return "text/plain"
            except UnicodeError:
                continue
        raise DocumentProcessingError(
            "The TXT file encoding is unsupported or contains binary data."
        )
    if suffix in {".pdf", ".docx", ".txt"}:
        raise DocumentProcessingError("The file content does not match its filename type.")
    raise DocumentProcessingError("Only PDF, DOCX and TXT reference documents are supported.")


def safe_source_filename(filename: str | None) -> str:
    value = (filename or "").replace("\\", "/").split("/")[-1].strip()
    value = re.sub(r"[\x00-\x1f\x7f]", "", value)
    if not value or value in {".", ".."} or len(value) > 255:
        raise DocumentProcessingError(
            "Choose a document with a simple filename under 256 characters."
        )
    return value


def _clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).replace("\r\n", "\n").replace("\r", "\n")
    return "".join(
        char
        for char in value
        if char in "\n\t" or unicodedata.category(char) not in {"Cc", "Cf", "Cs"}
    ).strip()


def _check_text_size(segments: list[dict], max_text_bytes: int) -> None:
    extracted = sum(len(segment["text"].encode("utf-8")) for segment in segments)
    if extracted > max_text_bytes:
        raise DocumentProcessingError("The extracted text exceeds the configured document limit.")


def extract_document(data: bytes, filename: str, settings) -> tuple[str, int | None, list[dict]]:
    """Validate content signatures and return file type, page count and ordered text segments."""
    if not data or len(data) > settings.max_document_bytes:
        raise DocumentProcessingError("The document is empty or exceeds the upload size limit.")
    suffix = PurePath(filename).suffix.casefold()
    segments: list[dict] = []
    page_count = None
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise DocumentProcessingError("The selected PDF file has an invalid signature.")
        try:
            reader = PdfReader(io.BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise DocumentProcessingError("Encrypted PDFs are not supported.")
            page_count = len(reader.pages)
            if page_count < 1 or page_count > settings.max_document_pages:
                raise DocumentProcessingError("The PDF page count is outside the supported limit.")
            for page_number, page in enumerate(reader.pages, start=1):
                text = _clean_text(page.extract_text() or "")
                if text:
                    segments.append(
                        {
                            "text": text,
                            "page_number": page_number,
                            "location": f"Page {page_number}",
                        }
                    )
        except DocumentProcessingError:
            raise
        except Exception:
            raise DocumentProcessingError(
                "The PDF is corrupt or could not be read safely."
            ) from None
        if sum(len(segment["text"]) for segment in segments) < 40:
            raise DocumentProcessingError(
                "This PDF has too little selectable text to index. Scanned pages need OCR."
            )
        file_type = "application/pdf"
    elif suffix == ".docx":
        if not data.startswith(b"PK"):
            raise DocumentProcessingError("The selected DOCX file has an invalid signature.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
                total_size = sum(info.file_size for info in archive.infolist())
                if (
                    "[Content_Types].xml" not in names
                    or "word/document.xml" not in names
                    or len(names) > 10_000
                    or total_size > settings.max_document_text_bytes * 4
                ):
                    raise DocumentProcessingError(
                        "The DOCX package is invalid or too large to extract."
                    )
            doc = DocxDocument(io.BytesIO(data))
            paragraph_number = 0
            for child in doc.element.body.iterchildren():
                if child.tag == qn("w:p"):
                    paragraph_number += 1
                    text = _clean_text(Paragraph(child, doc).text)
                    if text:
                        segments.append(
                            {
                                "text": text,
                                "page_number": None,
                                "location": f"Paragraph {paragraph_number}",
                            }
                        )
                elif child.tag == qn("w:tbl"):
                    table = Table(child, doc)
                    for row_number, row in enumerate(table.rows, start=1):
                        text = " | ".join(_clean_text(cell.text) for cell in row.cells)
                        if text.strip(" |\t\n"):
                            segments.append(
                                {
                                    "text": text,
                                    "page_number": None,
                                    "location": f"Table row {row_number}",
                                }
                            )
        except DocumentProcessingError:
            raise
        except Exception:
            raise DocumentProcessingError(
                "The DOCX is corrupt or could not be read safely."
            ) from None
        file_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif suffix == ".txt":
        if data.startswith((b"%PDF-", b"PK\x03\x04")):
            raise DocumentProcessingError("The file content does not match its TXT extension.")
        text = None
        for encoding in ("utf-8-sig", "utf-16", "cp1252"):
            try:
                text = data.decode(encoding, errors="strict")
                break
            except UnicodeError:
                continue
        if text is None or text.count("\x00") > max(1, len(text or "") // 100):
            raise DocumentProcessingError(
                "The TXT file encoding is unsupported or contains binary data."
            )
        text = _clean_text(text)
        if text:
            segments = [{"text": text, "page_number": None, "location": "Text file"}]
        file_type = "text/plain"
    else:
        raise DocumentProcessingError("Only PDF, DOCX and TXT reference documents are supported.")

    _check_text_size(segments, settings.max_document_text_bytes)
    if not segments:
        raise DocumentProcessingError("No usable text was found in this document.")
    return file_type, page_count, segments


def chunk_segments(segments: list[dict], chunk_chars: int, overlap: int) -> list[dict]:
    """Create reproducible bounded chunks while retaining each chunk's start location."""
    text_parts = []
    ranges = []
    cursor = 0
    for segment in segments:
        text = segment["text"].strip()
        if not text:
            continue
        if text_parts:
            cursor += 2
        start = cursor
        text_parts.append(text)
        cursor += len(text)
        ranges.append((start, cursor, segment["page_number"], segment["location"]))
    document_text = "\n\n".join(text_parts)
    chunks = []
    start = 0
    while start < len(document_text):
        end = min(start + chunk_chars, len(document_text))
        if end < len(document_text):
            boundary = document_text.rfind(" ", start + int(chunk_chars * 0.65), end)
            if boundary > start:
                end = boundary
        content = document_text[start:end].strip()
        if content:
            source = next((item for item in ranges if item[0] <= start < item[1]), ranges[-1])
            chunks.append(
                {
                    "content": content,
                    "page_number": source[2],
                    "location": source[3],
                }
            )
        if end >= len(document_text):
            break
        next_start = max(start + 1, end - overlap)
        boundary = document_text.find(" ", next_start, min(end, next_start + 100))
        start = boundary + 1 if boundary >= 0 else next_start
    return chunks
