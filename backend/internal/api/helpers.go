package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const dateLayout = "2006-01-02"

type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

func badRequest(msg string) error { return &apiError{http.StatusBadRequest, msg} }

var errNotFound = &apiError{http.StatusNotFound, "not found"}

// handlerFunc — обработчик, который может вернуть ошибку; она превращается в JSON-ответ.
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

func (h handlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		var ae *apiError
		switch {
		case errors.As(err, &ae):
			writeJSON(w, ae.status, map[string]string{"error": ae.msg})
		case errors.Is(err, sql.ErrNoRows):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		default:
			log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func decodeJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return badRequest("invalid JSON body: " + err.Error())
	}
	return nil
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, badRequest("invalid id")
	}
	return id, nil
}

func isDate(s string) bool {
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func requireDate(s, field string) error {
	if !isDate(s) {
		return badRequest(field + " must be a date in YYYY-MM-DD format")
	}
	return nil
}

// optDate проверяет необязательную дату: nil или пустая строка = NULL.
func optDate(s *string, field string) (*string, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil, nil
	}
	if !isDate(*s) {
		return nil, badRequest(field + " must be a date in YYYY-MM-DD format")
	}
	return s, nil
}

// optTime проверяет необязательное время HH:MM.
func optTime(s *string, field string) (*string, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil, nil
	}
	if _, err := time.Parse("15:04", *s); err != nil {
		return nil, badRequest(field + " must be a time in HH:MM format")
	}
	return s, nil
}

func requireTime(s, field string) error {
	if _, err := time.Parse("15:04", s); err != nil {
		return badRequest(field + " must be a time in HH:MM format")
	}
	return nil
}

func requireText(s, field string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", badRequest(field + " is required")
	}
	return s, nil
}

// dateRange читает ?from=&to=; по умолчанию — последние 30 дней.
func dateRange(r *http.Request, defaultDays int) (string, string, error) {
	q := r.URL.Query()
	to := q.Get("to")
	from := q.Get("from")
	now := time.Now()
	if to == "" {
		to = now.Format(dateLayout)
	}
	if from == "" {
		t, err := time.Parse(dateLayout, to)
		if err != nil {
			return "", "", badRequest("to must be a date in YYYY-MM-DD format")
		}
		from = t.AddDate(0, 0, -(defaultDays - 1)).Format(dateLayout)
	}
	if !isDate(from) || !isDate(to) {
		return "", "", badRequest("from/to must be dates in YYYY-MM-DD format")
	}
	if from > to {
		return "", "", badRequest("from must not be after to")
	}
	return from, to, nil
}

func mustAffect(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errNotFound
	}
	return nil
}

func nullStr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	return &ns.String
}
