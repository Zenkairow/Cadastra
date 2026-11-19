import os
import re
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'''
        <w:tcMar {nsdecls("w")}>
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    tcPr.append(tcMar)

def set_table_borders(table, color="CCCCCC", sz="4", val="single"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(f'''
        <w:tblBorders {nsdecls("w")}>
            <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:insideV w:val="none"/>
            <w:left w:val="none"/>
            <w:right w:val="none"/>
        </w:tblBorders>
    ''')
    tblPr.append(borders)

def add_callout_box(doc, text_lines, bg_hex="F8FAFC", border_color="94A3B8"):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.8)
    set_cell_background(cell, bg_hex)
    set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(f'''
        <w:tcBorders {nsdecls("w")}>
            <w:top w:val="none"/>
            <w:left w:val="single" w:sz="18" w:space="0" w:color="{border_color}"/>
            <w:bottom w:val="none"/>
            <w:right w:val="none"/>
        </w:tcBorders>
    ''')
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.05
    
    for i, line in enumerate(text_lines):
        if i > 0:
            p = cell.add_paragraph()
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(8.5)
        run.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
    
    # Empty space after table
    p_after = doc.add_paragraph()
    p_after.paragraph_format.space_before = Pt(0)
    p_after.paragraph_format.space_after = Pt(4)

def add_formatted_runs(paragraph, text, base_font="Times New Roman", base_size=10, is_italic_base=False):
    # Regex for markdown tokens: code, bold-italic, bold, italic, math
    token_pattern = re.compile(
        r'(`[^`]+`)'                   # `code`
        r'|(\*\*\*[^*]+\*\*\*)'        # ***bold-italic***
        r'|(\*\*[^*]+\*\*)'            # **bold**
        r'|(\*[^*]+\*)'                # *italic*
        r'|(\$[^$]+\$)'                # $math$
    )
    
    pos = 0
    for match in token_pattern.finditer(text):
        start, end = match.span()
        if start > pos:
            run = paragraph.add_run(text[pos:start])
            run.font.name = base_font
            run.font.size = Pt(base_size)
            run.italic = is_italic_base
            
        matched_text = match.group(0)
        if matched_text.startswith('`') and matched_text.endswith('`'):
            run = paragraph.add_run(matched_text[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(base_size - 0.5)
            run.font.color.rgb = RGBColor(0x8B, 0x1A, 0x1A)
        elif matched_text.startswith('***') and matched_text.endswith('***'):
            run = paragraph.add_run(matched_text[3:-3])
            run.font.name = base_font
            run.font.size = Pt(base_size)
            run.bold = True
            run.italic = True
        elif matched_text.startswith('**') and matched_text.endswith('**'):
            run = paragraph.add_run(matched_text[2:-2])
            run.font.name = base_font
            run.font.size = Pt(base_size)
            run.bold = True
            run.italic = is_italic_base
        elif matched_text.startswith('*') and matched_text.endswith('*'):
            run = paragraph.add_run(matched_text[1:-1])
            run.font.name = base_font
            run.font.size = Pt(base_size)
            run.italic = True
        elif matched_text.startswith('$') and matched_text.endswith('$'):
            math_str = matched_text[1:-1]
            # Clean common LaTeX syntax for word readability
            math_clean = (math_str.replace('\\text{', '')
                                  .replace('}', '')
                                  .replace('\\cap', '∩')
                                  .replace('\\cup', '∪')
                                  .replace('\\in', '∈')
                                  .replace('\\le', '≤')
                                  .replace('\\ge', '≥')
                                  .replace('\\ne', '≠')
                                  .replace('\\equiv', '≡')
                                  .replace('\\rightarrow', '→')
                                  .replace('\\to', '→')
                                  .replace('\\Delta', 'Δ')
                                  .replace('\\dim', 'dim')
                                  .replace('\\emptyset', '∅')
                                  .replace('\\mathbb{A}', 'Address')
                                  .replace('\\mathbb{N}', 'uint')
                                  .replace('\\subset', '⊂')
                                  .replace('\\mathcal{U}', 'U')
                                  .replace('\\mathcal{I}', 'I')
                                  .replace('\\mathcal{P}', 'P')
                                  .replace('\\mathcal{E}', 'E')
                                  .replace('\\mathcal{D}', 'D'))
            run = paragraph.add_run(math_clean)
            run.font.name = "Times New Roman"
            run.font.size = Pt(base_size)
            run.italic = True
            
        pos = end
        
    if pos < len(text):
        run = paragraph.add_run(text[pos:])
        run.font.name = base_font
        run.font.size = Pt(base_size)
        run.italic = is_italic_base

def parse_ascii_table(lines):
    # Extract table title if present
    table_title = ""
    clean_lines = []
    for l in lines:
        stripped = l.strip()
        if not stripped:
            continue
        if stripped.startswith('+') and ('---' in stripped):
            clean_lines.append(stripped)
        elif stripped.startswith('|'):
            # Check if this row is a single cell spanning the entire table with a title
            if 'TABLE ' in stripped or 'FIGURE ' in stripped:
                parts = [p.strip() for p in stripped.split('|') if p.strip()]
                if len(parts) == 1:
                    table_title = parts[0]
                    continue
            clean_lines.append(stripped)
    
    # Parse rows and columns
    rows_data = []
    for l in clean_lines:
        if l.startswith('+'):
            continue
        cells = [c.strip() for c in l.split('|')[1:-1]]
        if cells:
            rows_data.append(cells)
            
    return table_title, rows_data

def build_docx(md_path, docx_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    doc = docx.Document()

    # Set 0.75-inch margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    # Styles
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(10)
    normal_style.font.color.rgb = RGBColor(0x11, 0x18, 0x27)

    lines = content.split('\n')
    i = 0
    total_lines = len(lines)

    in_abstract = False
    
    while i < total_lines:
        line = lines[i]
        stripped = line.strip()

        # Blank line
        if not stripped:
            i += 1
            continue

        # Code block
        if stripped.startswith('```'):
            lang = stripped[3:].strip().lower()
            code_lines = []
            i += 1
            while i < total_lines and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i].rstrip())
                i += 1
            if i < total_lines:
                i += 1 # skip closing ```

            block_text = '\n'.join(code_lines)
            
            # Check if this block is an ASCII Table
            if any('TABLE ' in l for l in code_lines[:3]) and any('|' in l for l in code_lines):
                title, rows_data = parse_ascii_table(code_lines)
                if rows_data:
                    # Add caption if title found
                    if title:
                        caption = doc.add_paragraph()
                        caption.paragraph_format.space_before = Pt(8)
                        caption.paragraph_format.space_after = Pt(4)
                        caption.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        r = caption.add_run(title)
                        r.font.name = "Times New Roman"
                        r.font.size = Pt(9.5)
                        r.bold = True
                        r.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)

                    # Build Word Table
                    num_rows = len(rows_data)
                    num_cols = max(len(r) for r in rows_data)
                    tbl = doc.add_table(rows=num_rows, cols=num_cols)
                    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                    set_table_borders(tbl, color="CBD5E1", sz="6", val="single")

                    # Column widths calculation
                    avail_width = 6.8
                    col_width = Inches(avail_width / num_cols)

                    for row_idx, r_data in enumerate(rows_data):
                        row = tbl.rows[row_idx]
                        is_header = (row_idx == 0)
                        
                        # Pad row data if needed
                        while len(r_data) < num_cols:
                            r_data.append("")

                        for col_idx, cell_value in enumerate(r_data):
                            cell = row.cells[col_idx]
                            cell.width = col_width
                            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                            
                            # Styling
                            if is_header:
                                set_cell_background(cell, "0F2744") # Dark navy header
                                set_cell_margins(cell, top=100, bottom=100, left=120, right=120)
                            else:
                                bg = "F8FAFC" if (row_idx % 2 == 1) else "FFFFFF"
                                set_cell_background(cell, bg)
                                set_cell_margins(cell, top=80, bottom=80, left=100, right=100)

                            cp = cell.paragraphs[0]
                            cp.paragraph_format.space_before = Pt(0)
                            cp.paragraph_format.space_after = Pt(0)
                            cp.paragraph_format.line_spacing = 1.05
                            
                            if is_header:
                                cp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
                                run = cp.add_run(cell_value)
                                run.font.name = "Times New Roman"
                                run.font.size = Pt(8.5)
                                run.bold = True
                                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                            else:
                                # Align numbers center/right, text left
                                is_numeric = bool(re.match(r'^[\d\.,%\s\$\-\+x\(\)]+$', cell_value.replace('ms', '').replace('gas', '').replace('sec', '')))
                                if is_numeric or len(cell_value) <= 8:
                                    cp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
                                else:
                                    cp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
                                    
                                add_formatted_runs(cp, cell_value, base_font="Times New Roman", base_size=8.5)

                    # Space after table
                    p_sp = doc.add_paragraph()
                    p_sp.paragraph_format.space_before = Pt(0)
                    p_sp.paragraph_format.space_after = Pt(6)
                    continue

            # Otherwise, render as formatted Callout Box / Monospace Code Box
            border_color = "2563EB" if lang in ['solidity', 'sql', 'json'] else "94A3B8"
            bg_color = "F1F5F9" if lang in ['solidity', 'sql', 'json'] else "F8FAFC"
            add_callout_box(doc, code_lines, bg_hex=bg_color, border_color=border_color)
            continue

        # Document Title (# Cadastra: ...)
        if stripped.startswith('# '):
            title_text = stripped[2:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(8)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(title_text)
            run.font.name = 'Times New Roman'
            run.font.size = Pt(20)
            run.bold = True
            run.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
            i += 1
            continue

        # Authors line (**Ayush Sharma...**)
        if stripped.startswith('**') and ('Ayush Sharma' in stripped or 'Department of' in stripped or 'Target Publication' in stripped or 'Artifact Repository' in stripped or 'Testnet Deployment' in stripped or '@cadastra.org' in stripped or 'contributed equally' in stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            if 'Ayush Sharma' in stripped:
                run = p.add_run(stripped.replace('**', ''))
                run.font.name = 'Times New Roman'
                run.font.size = Pt(11)
                run.bold = True
                run.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
            else:
                add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=9.5)
            i += 1
            continue

        # Affiliation / emails / note
        if stripped.startswith('*Department of') or stripped.startswith('¹ayush') or stripped.startswith('*\\*All authors') or stripped.startswith('**Target Publication') or stripped.startswith('**Artifact') or stripped.startswith('**Testnet'):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=9)
            i += 1
            continue

        # Divider line (---)
        if stripped == '---':
            # Add thin decorative divider
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(8)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run("_______________________________________________________________________________")
            r.font.name = "Times New Roman"
            r.font.size = Pt(8)
            r.font.color.rgb = RGBColor(0xCB, 0xD5, 0xE1)
            i += 1
            continue

        # Abstract Header (### Abstract)
        if stripped == '### Abstract':
            in_abstract = True
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
            run = p.add_run("Abstract")
            run.font.name = 'Times New Roman'
            run.font.size = Pt(11)
            run.bold = True
            run.italic = True
            run.font.color.rgb = RGBColor(0x0F, 0x27, 0x44)
            i += 1
            continue

        # Index Terms (Index Terms— ...)
        if 'Index Terms—' in stripped or 'Keywords:' in stripped:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(10)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.left_indent = Inches(0.2)
            p.paragraph_format.right_indent = Inches(0.2)
            add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=9.5)
            in_abstract = False
            i += 1
            continue

        # Abstract content
        if in_abstract:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.left_indent = Inches(0.2)
            p.paragraph_format.right_indent = Inches(0.2)
            add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=9.5)
            i += 1
            continue

        # Section Headings (## I. Introduction, ## II. Problem Definition...)
        if stripped.startswith('## '):
            heading_text = stripped[3:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            
            run = p.add_run(heading_text)
            run.font.name = 'Times New Roman'
            run.font.size = Pt(12)
            run.bold = True
            run.font.color.rgb = RGBColor(0x0F, 0x27, 0x44)
            i += 1
            continue

        # Subsection Headings (### A. Separation of Responsibilities...)
        if stripped.startswith('### '):
            heading_text = stripped[4:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.keep_with_next = True
            
            run = p.add_run(heading_text)
            run.font.name = 'Times New Roman'
            run.font.size = Pt(11)
            run.bold = True
            run.italic = True
            run.font.color.rgb = RGBColor(0x1E, 0x3A, 0x5F)
            i += 1
            continue

        # Sub-subsection Headings (#### 1. Zero-PII Invariant...)
        if stripped.startswith('#### '):
            heading_text = stripped[5:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.keep_with_next = True
            
            run = p.add_run(heading_text)
            run.font.name = 'Times New Roman'
            run.font.size = Pt(10.5)
            run.bold = True
            run.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
            i += 1
            continue

        # Display Math ($$...$$)
        if stripped.startswith('$$') and stripped.endswith('$$') and len(stripped) > 4:
            math_expr = stripped[2:-2].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(5)
            p.paragraph_format.space_after = Pt(5)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_formatted_runs(p, f"${math_expr}$", base_font="Times New Roman", base_size=10.5)
            i += 1
            continue

        # Multiline Display Math ($$ ...)
        if stripped.startswith('$$'):
            math_lines = []
            math_lines.append(stripped[2:].strip())
            i += 1
            while i < total_lines and not lines[i].strip().endswith('$$'):
                math_lines.append(lines[i].strip())
                i += 1
            if i < total_lines:
                math_lines.append(lines[i].strip()[:-2].strip())
                i += 1
            full_math = ' '.join(math_lines)
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(5)
            p.paragraph_format.space_after = Pt(5)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_formatted_runs(p, f"${full_math}$", base_font="Times New Roman", base_size=10.5)
            continue

        # Bullet List Items (- or * )
        if stripped.startswith(('- ', '* ')) and not stripped.startswith('**'):
            list_text = stripped[2:].strip()
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.12
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            add_formatted_runs(p, list_text, base_font="Times New Roman", base_size=10)
            i += 1
            continue

        # Numbered List Items (1. , 2. )
        num_match = re.match(r'^(\d+)\.\s+(.*)$', stripped)
        if num_match and not stripped.startswith('[1]'):
            num_idx = num_match.group(1)
            list_text = num_match.group(2)
            p = doc.add_paragraph(style='List Number')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.12
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            add_formatted_runs(p, list_text, base_font="Times New Roman", base_size=10)
            i += 1
            continue

        # References list item ([1] Author, ...)
        ref_match = re.match(r'^\[(\d+)\]\s+(.*)$', stripped)
        if ref_match:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.left_indent = Inches(0.3)
            p.paragraph_format.first_line_indent = Inches(-0.3)
            p.paragraph_format.line_spacing = 1.08
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=9)
            i += 1
            continue

        # Standard Body Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        add_formatted_runs(p, stripped, base_font="Times New Roman", base_size=10)
        i += 1

    doc.save(docx_path)
    print(f"Successfully generated DOCX at {docx_path}")

if __name__ == '__main__':
    md_file = r'c:\Users\ayush\OneDrive\Desktop\Land-registry\docs\IEEE_Research_Paper_Final.md'
    docx_file = r'c:\Users\ayush\OneDrive\Desktop\Land-registry\docs\IEEE_Research_Paper_Final.docx'
    build_docx(md_file, docx_file)
