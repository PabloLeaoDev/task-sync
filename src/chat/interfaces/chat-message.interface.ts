export interface ChatMessage {
  id: string;
  roomId: string;
  sender: {
    id: string;
    name: string;
  };
  content: string;
  createdAt: string;
}
