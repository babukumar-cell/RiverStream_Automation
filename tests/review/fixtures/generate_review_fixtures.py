"""
Regenerates the spreadsheet and EDI fixtures used by tests/review.

    python tests/review/fixtures/generate_review_fixtures.py

Requires openpyxl. The values written here are the "known values" that tests/review/review-data.ts
asserts against, so keep the two files in sync when changing anything below.

The other fixtures in this folder are copies of real customer-style documents:
  review-po-8-pages.pdf  <- Test Cases/PO ACK files/CRI Files/New files/Purchase_Order_2505355.pdf
  review-quote.sif       <- Riverstone test SIF Files/CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA7.sif
"""
import os

from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))

PO_NUMBER = "RVW-XLS-50731"
PO_DATE = "10/07/2026"
SOLD_TO = ["Lakeside Office Group", "410 Harbor View Dr", "Charleston, SC 29401"]
SHIP_TO = ["Lakeside Warehouse", "88 Commerce Park Rd", "Summerville, SC 29483"]
LINES = [
    (4, "CD-309M", "Zetti Mid Back Chair", 1120.00),
    (2, "CD-P3422-S", "Potenza 2 Door Storage Cabinet", 870.00),
    (1, "CD-CCTT10", "Coltello 10ft Conference Table Top", 1370.00),
]
CURRENCY = '"$"#,##0.00'


def build_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "PO"
    ws.append(["Lakeside Office Group"])
    ws.append(["410 Harbor View Dr"])
    ws.append(["Charleston, SC 29401"])
    ws.append([])
    ws.append(["Purchase Order"])
    ws.append(["PO Date:", PO_DATE, "", "PO Number:", PO_NUMBER])
    ws.append([])
    ws.append(["Sold To:", "", "", "Ship To:"])
    for sold, ship in zip(SOLD_TO, SHIP_TO):
        ws.append([sold, "", "", ship])
    ws.append([])
    ws.append(["QTY", "Model/Item #", "Description/Option", "Unit Price", "Total"])
    for qty, item, desc, price in LINES:
        ws.append([qty, item, desc, price, round(qty * price, 2)])
        ws.cell(row=ws.max_row, column=4).number_format = CURRENCY
        ws.cell(row=ws.max_row, column=5).number_format = CURRENCY
    ws.append([])
    ws.append(["", "", "", "TOTAL:", round(sum(q * p for q, _, _, p in LINES), 2)])
    ws.cell(row=ws.max_row, column=5).number_format = CURRENCY
    for col, width in zip("ABCDE", (22, 18, 38, 14, 14)):
        ws.column_dimensions[col].width = width
    wb.save(path)


# X12 850 purchase order with buyer (BT) and ship-to (ST) parties and two PO1 lines.
EDI_SEGMENTS = [
    "ISA*00*          *00*          *ZZ*LAKESIDEOG     *ZZ*RIVERSTONE     *261007*0930*U*00401*000000731*0*T*:",
    "GS*PO*LAKESIDEOG*RIVERSTONE*20261007*0930*731*X*004010",
    "ST*850*0731",
    "BEG*00*NE*RVW-EDI-40917**20261007",
    "N1*BT*Lakeside Office Group",
    "N3*410 Harbor View Dr",
    "N4*Charleston*SC*29401",
    "N1*ST*Lakeside Warehouse",
    "N3*88 Commerce Park Rd",
    "N4*Summerville*SC*29483",
    "PO1*1*4*EA*1120.00**VP*CD-309M",
    "PID*F****Zetti Mid Back Chair",
    "PO1*2*2*EA*870.00**VP*CD-P3422-S",
    "PID*F****Potenza 2 Door Storage Cabinet",
    "CTT*2",
    "SE*15*0731",
    "GE*1*731",
    "IEA*1*000000731",
]


def build_edi(path):
    with open(path, "w", newline="") as f:
        f.write("~".join(EDI_SEGMENTS) + "~")


if __name__ == "__main__":
    build_xlsx(os.path.join(HERE, "review-po.xlsx"))
    build_edi(os.path.join(HERE, "review-order.edi"))
    print("Fixtures written to", HERE)
