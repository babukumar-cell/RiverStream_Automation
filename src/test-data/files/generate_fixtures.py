"""
Regenerates the static upload fixtures used by tests/upload and tests/documents.

    python src/test-data/files/generate_fixtures.py

Requires openpyxl and reportlab. The legacy .xls copy is produced through Excel (Windows COM, via
PowerShell) when it is available; otherwise the committed sample-po.xls is left untouched.
"""
import os
import subprocess
import sys

from openpyxl import Workbook
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))

HEADER = [
    ("Purchase Order", "PO-AUTO-48213"),
    ("PO Date", "2026-10-07"),
    ("Vendor", "Riverstone Test Supplies LLC"),
    ("Bill To", "Riverstonetech QA, 100 Main Street, Charlotte, NC 28202"),
    ("Ship To", "Riverstonetech Warehouse, 200 Commerce Way, Charlotte, NC 28203"),
]
LINES = [
    ("CH-1001", "Task chair, black mesh", 12, 189.00),
    ("DK-2040", "Height adjustable desk 60x30", 6, 649.50),
    ("FL-3300", "Lateral file cabinet, 3 drawer", 4, 412.75),
    ("TB-0905", "Conference table 96in", 1, 1899.00),
]


def build_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Purchase Order"
    for label, value in HEADER:
        ws.append([label, value])
    ws.append([])
    ws.append(["Line", "Item Number", "Description", "Quantity", "Unit Price", "Extended Price"])
    for i, (item, desc, qty, price) in enumerate(LINES, start=1):
        ws.append([i, item, desc, qty, price, round(qty * price, 2)])
    ws.append([])
    ws.append(["", "", "", "", "Total", round(sum(q * p for _, _, q, p in LINES), 2)])
    wb.save(path)


def build_legacy_xls(xlsx_path, xls_path):
    """Converts the .xlsx to the legacy BIFF8 .xls format through Excel's COM automation (Windows only)."""
    if os.name != "nt":
        print("Excel COM is only available on Windows; keeping the committed sample-po.xls")
        return
    script = (
        "$x = New-Object -ComObject Excel.Application; $x.DisplayAlerts = $false; "
        f"$wb = $x.Workbooks.Open('{xlsx_path}'); $wb.SaveAs('{xls_path}', 56); $wb.Close($false); $x.Quit()"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True)
    if result.returncode != 0:
        print("Excel conversion failed; keeping the committed sample-po.xls:", result.stderr.strip())


def build_multipage_pdf(path, pages=12):
    c = canvas.Canvas(path, pagesize=letter)
    width, height = letter
    for page in range(1, pages + 1):
        y = height - 60
        c.setFont("Helvetica-Bold", 16)
        c.drawString(50, y, "PURCHASE ORDER PO-AUTO-48213")
        c.setFont("Helvetica", 10)
        c.drawRightString(width - 50, y, f"Page {page} of {pages}")
        y -= 30
        if page == 1:
            for label, value in HEADER[1:]:
                c.drawString(50, y, f"{label}: {value}")
                y -= 16
            y -= 10
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, "Line   Item Number   Description                              Qty     Unit Price")
        c.setFont("Helvetica", 10)
        y -= 18
        for n in range(1, 21):
            item, desc, qty, price = LINES[(page + n) % len(LINES)]
            line_no = (page - 1) * 20 + n
            c.drawString(50, y, f"{line_no:<6} {item:<13} {desc:<40} {qty:<7} {price:>10.2f}")
            y -= 16
        c.showPage()
    c.save()


if __name__ == "__main__":
    xlsx = os.path.join(HERE, "sample-po.xlsx")
    build_xlsx(xlsx)
    build_legacy_xls(xlsx, os.path.join(HERE, "sample-po.xls"))
    build_multipage_pdf(os.path.join(HERE, "sample-po-12-pages.pdf"))
    print("fixtures written to", HERE, file=sys.stderr)
