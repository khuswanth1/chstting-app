# ChatFlow — Frontend

A real-time messaging and collaboration web application built with React, Vite, TailwindCSS, and Zustand.

## 🚀 Features

- **Real-time Messaging**: Instant direct messages and group conversations via WebSockets.
- **Client-side Routing**: Full deep-linking support using React Router (`/chats`, `/chats/:id`, `/status`, `/calls`, `/settings`, `/login`, `/register`).
- **Voice & Video Calls**: 1:1 and group call interfaces with WebRTC.
- **ChatFlow AI**: Integrated AI chatbot capabilities.
- **Stories & Status**: 24-hour disappearing status updates.
- **Theme Support**: Seamless Dark, Light, and System themes.
- **Responsive Design**: Mobile-first design that adapts seamlessly from phones to large screens.

## 🛠️ Tech Stack

- **Framework**: React 19 + Vite
- **Routing**: React Router v7
- **State Management**: Zustand
- **Styling**: TailwindCSS
- **Real-time**: WebSockets

## 📦 Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure `VITE_API_URL` points to your backend server (e.g. `http://localhost:8000`).

### 3. Run Development Server
```bash
npm run dev
```

### 4. Build for Production
```bash
npm run build
```
