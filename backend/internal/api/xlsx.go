package api

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
	"time"
)

// Минимальный генератор .xlsx (Office Open XML) на стандартной библиотеке:
// строки, даты, жирная шапка, перенос текста, закреплённая шапка и автофильтр.

const (
	styleDefault = 0
	styleHeader  = 1
	styleDate    = 2
	styleWrap    = 3
	styleTop     = 4
	styleTime    = 5
)

// xlsxClock — время суток (ЧЧ:ММ), записывается в Excel как настоящее время.
type xlsxClock string

type xlsxCell struct {
	Value any // string | time.Time | int | nil
	Style int
}

type xlsxSheet struct {
	Name   string
	Widths []float64 // ширина колонок в символах
	Header []string
	Rows   [][]xlsxCell
}

func writeXLSX(w io.Writer, sheets []xlsxSheet) error {
	zw := zip.NewWriter(w)
	add := func(name, body string) error {
		f, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = io.WriteString(f, body)
		return err
	}

	var ct, wbSheets, wbRels strings.Builder
	for i, s := range sheets {
		n := i + 1
		fmt.Fprintf(&ct, `<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, n)
		fmt.Fprintf(&wbSheets, `<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlEscape(s.Name), n, n)
		fmt.Fprintf(&wbRels, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, n, n)
	}
	stylesID := len(sheets) + 1

	files := []struct{ name, body string }{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
			`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
			ct.String() + `</Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
			`</Relationships>`},
		{"xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
			`<sheets>` + wbSheets.String() + `</sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + wbRels.String() +
			fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, stylesID) +
			`</Relationships>`},
		{"xl/styles.xml", stylesXML},
	}
	for _, f := range files {
		if err := add(f.name, f.body); err != nil {
			return err
		}
	}
	for i, s := range sheets {
		if err := add(fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1), sheetXML(s)); err != nil {
			return err
		}
	}
	return zw.Close()
}

// Стили: 0 — обычный, 1 — шапка, 2 — дата ДД.ММ.ГГГГ, 3 — перенос текста, 4 — по верху, 5 — время ЧЧ:ММ.
const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
	`<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>` +
	`<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
	`<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
	`<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills>` +
	`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
	`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
	`<cellXfs count="6">` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
	`<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
	`<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
	`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>` +
	`<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>` +
	`</cellXfs>` +
	`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
	`</styleSheet>`

func sheetXML(s xlsxSheet) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	// При печати — вписать по ширине страницы
	b.WriteString(`<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`)
	// Закреплённая первая строка
	b.WriteString(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
	if len(s.Widths) > 0 {
		b.WriteString(`<cols>`)
		for i, w := range s.Widths {
			fmt.Fprintf(&b, `<col min="%d" max="%d" width="%.1f" customWidth="1"/>`, i+1, i+1, w)
		}
		b.WriteString(`</cols>`)
	}
	b.WriteString(`<sheetData>`)
	header := make([]xlsxCell, len(s.Header))
	for i, h := range s.Header {
		header[i] = xlsxCell{h, styleHeader}
	}
	rows := append([][]xlsxCell{header}, s.Rows...)
	for r, row := range rows {
		if r == 0 {
			fmt.Fprintf(&b, `<row r="1" ht="22" customHeight="1">`)
		} else {
			fmt.Fprintf(&b, `<row r="%d">`, r+1)
		}
		for c, cell := range row {
			ref := fmt.Sprintf("%s%d", colName(c), r+1)
			switch v := cell.Value.(type) {
			case nil:
				fmt.Fprintf(&b, `<c r="%s" s="%d"/>`, ref, cell.Style)
			case time.Time:
				fmt.Fprintf(&b, `<c r="%s" s="%d"><v>%d</v></c>`, ref, cell.Style, excelSerial(v))
			case xlsxClock:
				var h, m int
				fmt.Sscanf(string(v), "%d:%d", &h, &m)
				fmt.Fprintf(&b, `<c r="%s" s="%d"><v>%.10f</v></c>`, ref, cell.Style, float64(h*60+m)/1440)
			case int:
				fmt.Fprintf(&b, `<c r="%s" s="%d"><v>%d</v></c>`, ref, cell.Style, v)
			case string:
				fmt.Fprintf(&b, `<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, cell.Style, xmlEscape(v))
			default:
				fmt.Fprintf(&b, `<c r="%s" s="%d" t="inlineStr"><is><t>%s</t></is></c>`, ref, cell.Style, xmlEscape(fmt.Sprint(v)))
			}
		}
		b.WriteString(`</row>`)
	}
	b.WriteString(`</sheetData>`)
	if len(s.Header) > 0 {
		fmt.Fprintf(&b, `<autoFilter ref="A1:%s%d"/>`, colName(len(s.Header)-1), len(rows))
	}
	b.WriteString(`<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>`)
	b.WriteString(`<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`)
	b.WriteString(`</worksheet>`)
	return b.String()
}

// colName: 0 → A, 25 → Z, 26 → AA.
func colName(i int) string {
	name := ""
	for i >= 0 {
		name = string(rune('A'+i%26)) + name
		i = i/26 - 1
	}
	return name
}

// excelSerial — номер дня в системе дат Excel (1900).
func excelSerial(t time.Time) int {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return int(d.Sub(base).Hours() / 24)
}

func xmlEscape(s string) string {
	// Убираем управляющие символы, недопустимые в XML 1.0 (кроме таба и переносов).
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			return -1
		}
		return r
	}, s)
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
