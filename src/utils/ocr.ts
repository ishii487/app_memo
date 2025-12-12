import Tesseract from 'tesseract.js';

export async function recognizeTextFromCanvas(canvas: HTMLCanvasElement): Promise<string> {
    // Create a temporary canvas to ensure white background
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return '';

    // Fill white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw original canvas over
    ctx.drawImage(canvas, 0, 0);

    const result = await Tesseract.recognize(
        tempCanvas,
        'jpn',
        {
            logger: m => console.log(m),
        }
    );

    return result.data.text;
}
