The viewer can load both 2D images and 3D volumes
	If the data is 2D image, then there is a single XY view with thumbnail sidebar
	If the data is 3D volume, then there is a 2x2 view with XY, XZ, YZ slices and 3D MIP rendering

Supported image formats
	2D: .tiff, .jpg, .png, .gif, .webp, .bmp
	3D: .raw with .json metadata file (uint8, uint16, float32)

Tools
	Zoom and pan (synchronized across all views)
	Contrast and brightness adjustment
	Histogram with draggable min/max handles
	ROI selection for auto-windowing
	Crosshairs with synchronized position across views
	Pixel value display at crosshair position

3D Volume Features
	Slice navigation with mouse wheel
	Double-click to maximize/restore single view
	Progressive loading with low-res preview for large files
	Streaming mode for very large volumes (>1GB)

3D Rendering (MIP)
	WebGL2 GPU-accelerated rendering
	CPU fallback when WebGL unavailable
	Track (rotate) with left mouse button
	Pan (translate) with both mouse buttons
	Zoom with scroll wheel
	Progressive quality (low during interaction, high when idle)
	Display range and gamma controls
