import { Navigate, Route, Routes } from "react-router-dom";
import { CommentPage } from "./routes/CommentPage";
import { FeedPage } from "./routes/FeedPage";
import { PostPage } from "./routes/PostPage";

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-md overflow-x-hidden border-x border-black/10 bg-hn-cream shadow-tweet">
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/comment/:id" element={<CommentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
