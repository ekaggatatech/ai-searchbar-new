import { generateAIResponse } from "../services/apiService.js";

export const searchWithAI = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please enter a search query.",
      });
    }

    const answer = await generateAIResponse(query.trim());

    return res.status(200).json({
      success: true,
      query,
      answer,
    });
  } catch (error) {
  console.error("========== AI ERROR ==========");
  console.error("Message:", error.message);
  console.error("Status:", error.status);
  console.error("Details:", error.errorDetails);
  console.error("==================================");

  return res.status(500).json({
    success: false,
    message: "AI response could not be generated.",
    error: error.message,
  });
}
    };
