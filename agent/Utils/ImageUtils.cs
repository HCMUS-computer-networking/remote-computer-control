using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace AgentSystem.Utils
{
    public static class ImageUtils
    {
        /// <summary>
        /// Nén ảnh Bitmap thành mảng byte định dạng JPEG với chất lượng chỉ định.
        /// </summary>
        public static byte[] CompressImageToJpeg(Bitmap bmp, int quality)
        {
            ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
            using (var encoderParameters = new EncoderParameters(1))
            using (var memoryStream = new MemoryStream())
            {
                var encoderParameter = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
                encoderParameters.Param[0] = encoderParameter;
                
                bmp.Save(memoryStream, jpegEncoder, encoderParameters);
                return memoryStream.ToArray();
            }
        }

        private static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid)
                {
                    return codec;
                }
            }
            return null;
        }
    }
}