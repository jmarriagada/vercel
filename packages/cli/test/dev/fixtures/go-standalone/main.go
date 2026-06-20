package main

import (
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Standalone Go: %s", r.URL.Path)
	})
	http.ListenAndServe(":"+port, nil)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "expected websocket upgrade", http.StatusBadRequest)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket upgrades are not supported", http.StatusInternalServerError)
		return
	}

	conn, readWriter, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()

	acceptHash := sha1.Sum([]byte(
		r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
	))
	accept := base64.StdEncoding.EncodeToString(acceptHash[:])
	_, _ = fmt.Fprintf(
		readWriter,
		"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n",
		accept,
	)
	if err := readWriter.Flush(); err != nil {
		return
	}

	for {
		header := make([]byte, 2)
		if _, err := io.ReadFull(readWriter, header); err != nil {
			return
		}

		opcode := header[0] & 0x0f
		payloadLength := int(header[1] & 0x7f)
		if opcode == 0x8 || payloadLength > 125 {
			return
		}

		mask := make([]byte, 4)
		if _, err := io.ReadFull(readWriter, mask); err != nil {
			return
		}
		payload := make([]byte, payloadLength)
		if _, err := io.ReadFull(readWriter, payload); err != nil {
			return
		}
		for i := range payload {
			payload[i] ^= mask[i%len(mask)]
		}

		if _, err := readWriter.Write([]byte{0x81, byte(len(payload))}); err != nil {
			return
		}
		if _, err := readWriter.Write(payload); err != nil {
			return
		}
		if err := readWriter.Flush(); err != nil {
			return
		}
	}
}
