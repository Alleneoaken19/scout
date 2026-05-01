"""PDF text extraction for resume upload."""

import fitz  # PyMuPDF


class PDFExtractionError(Exception):
    pass


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF file.

    Raises PDFExtractionError on corrupt or unreadable files.
    Returns a warning-prefixed string if the PDF appears to be scanned/image-based.
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise PDFExtractionError(f"Cannot open PDF: {e}") from e

    pages_text = []
    for page in doc:
        pages_text.append(page.get_text())
    doc.close()

    full_text = "\n".join(pages_text).strip()

    if len(full_text) < 50:
        raise PDFExtractionError(
            "PDF appears to be scanned or image-based. "
            "Please use a text-based PDF or enter your resume manually."
        )

    return full_text
