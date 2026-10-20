package api

import (
	"database/sql"
	"net/http"
	"strings"
)

// Области знаний — общие для тем самообучения и книг.
var areas = map[string]bool{"logic": true, "humanities": true, "creative": true, "self": true}

func validateArea(a *string) error {
	if *a == "" {
		*a = "logic"
	}
	if !areas[*a] {
		return badRequest("area must be one of logic, humanities, creative, self")
	}
	return nil
}

type Book struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title"`
	Author     string  `json:"author"`
	Area       string  `json:"area"`
	Status     string  `json:"status"` // want | reading | done
	Pages      *int    `json:"pages"`
	PagesRead  int     `json:"pages_read"`
	FinishedOn *string `json:"finished_on"`
	Rating     *int    `json:"rating"`
	Notes      string  `json:"notes"`
}

type bookInput struct {
	Title      string  `json:"title"`
	Author     string  `json:"author"`
	Area       string  `json:"area"`
	Status     string  `json:"status"`
	Pages      *int    `json:"pages"`
	PagesRead  int     `json:"pages_read"`
	FinishedOn *string `json:"finished_on"`
	Rating     *int    `json:"rating"`
	Notes      string  `json:"notes"`
}

func (in *bookInput) validate() error {
	t, err := requireText(in.Title, "title")
	if err != nil {
		return err
	}
	in.Title = t
	in.Author, in.Notes = strings.TrimSpace(in.Author), strings.TrimSpace(in.Notes)
	if err := validateArea(&in.Area); err != nil {
		return err
	}
	if in.Status == "" {
		in.Status = "want"
	}
	if in.Status != "want" && in.Status != "reading" && in.Status != "done" {
		return badRequest("status must be want, reading or done")
	}
	if in.Pages != nil && (*in.Pages <= 0 || *in.Pages > 20000) {
		return badRequest("pages must be between 1 and 20000")
	}
	if in.PagesRead < 0 {
		return badRequest("pages_read must not be negative")
	}
	if in.Pages != nil && in.PagesRead > *in.Pages {
		in.PagesRead = *in.Pages
	}
	if in.Rating != nil && (*in.Rating < 1 || *in.Rating > 5) {
		return badRequest("rating must be between 1 and 5")
	}
	if in.FinishedOn, err = optDate(in.FinishedOn, "finished_on"); err != nil {
		return err
	}
	switch in.Status {
	case "done":
		if in.Pages != nil {
			in.PagesRead = *in.Pages
		}
	case "want":
		in.PagesRead = 0
		in.FinishedOn = nil
	case "reading":
		in.FinishedOn = nil
	}
	return nil
}

const bookCols = `id, title, author, area, status, pages, pages_read, finished_on::text, rating, notes`

func scanBook(sc interface{ Scan(...any) error }) (Book, error) {
	var b Book
	var fin sql.NullString
	err := sc.Scan(&b.ID, &b.Title, &b.Author, &b.Area, &b.Status, &b.Pages, &b.PagesRead, &fin, &b.Rating, &b.Notes)
	b.FinishedOn = nullStr(fin)
	return b, err
}

// GET /api/books — сначала «читаю», затем «хочу прочитать», затем прочитанные (свежие сверху).
func (s *Server) listBooks(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT `+bookCols+` FROM books WHERE user_id = app_uid()
		ORDER BY array_position(ARRAY['reading','want','done'], status), finished_on DESC NULLS LAST, id DESC`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Book{}
	for rows.Next() {
		b, err := scanBook(rows)
		if err != nil {
			return err
		}
		out = append(out, b)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createBook(w http.ResponseWriter, r *http.Request) error {
	var in bookInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	b, err := scanBook(s.q(r).QueryRowContext(r.Context(), `INSERT INTO books
		(title, author, area, status, pages, pages_read, finished_on, rating, notes)
		VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'done' THEN COALESCE($7::date, CURRENT_DATE) END, $8, $9)
		RETURNING `+bookCols,
		in.Title, in.Author, in.Area, in.Status, in.Pages, in.PagesRead, in.FinishedOn, in.Rating, in.Notes))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, b)
	return nil
}

func (s *Server) updateBook(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in bookInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	b, err := scanBook(s.q(r).QueryRowContext(r.Context(), `UPDATE books SET
		title = $1, author = $2, area = $3, status = $4, pages = $5, pages_read = $6,
		finished_on = CASE WHEN $4 = 'done' THEN COALESCE($7::date, finished_on, CURRENT_DATE) END,
		rating = $8, notes = $9
		WHERE id = $10 AND user_id = app_uid() RETURNING `+bookCols,
		in.Title, in.Author, in.Area, in.Status, in.Pages, in.PagesRead, in.FinishedOn, in.Rating, in.Notes, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, b)
	return nil
}

func (s *Server) deleteBook(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "books")
}
