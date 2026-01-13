# Migration to Industrial CT Viewer

## Summary of Changes

This document outlines all changes made to rebrand from "Medical Image Viewer" to "Industrial CT Viewer".

## Files Renamed

### JavaScript Modules
- `js/MedicalViewer.js` → `js/CTViewer.js`

## Code Changes

### Class Names
- `MedicalViewer` → `CTViewer`

### HTML Elements
- **Title**: "Medical Image Viewer" → "Industrial CT Viewer"
- **Header**: "Image Viewer" → "Industrial CT Viewer"
- **Script src**: `js/MedicalViewer.js` → `js/CTViewer.js`
- **Class names**:
  - `.medical-controls` → `.ct-controls`
  - `.medical-view` → `.ct-view`
- **Element IDs**:
  - `#medicalControls` → `#ctControls`
  - `#medical3DView` → `#ct3DView`

### CSS Classes
- `.medical-controls` → `.ct-controls`
- `.medical-view` → `.ct-view`
- Comments updated to reflect CT focus

### JavaScript Variables & Methods
- `this.medicalViewer` → `this.ctViewer`
- `this.medicalControls` → `this.ctControls`
- `this.medical3DView` → `this.ct3DView`
- `initMedicalComponents()` → `initCTComponents()`
- `loadMedicalVolume()` → `loadCTVolume()`
- `switchToMedicalMode()` → `switchToCTMode()`
- Mode value: `'medical'` → `'ct'`

### Comments
- All references to "medical imaging" → "CT imaging" or "industrial CT"
- All references to "medical viewer" → "CT viewer"
- All references to "medical mode" → "CT mode"
- All references to "medical controls" → "CT controls"

## Documentation Updates

### README.md
- **Title**: Medical Image Viewer → Industrial CT Viewer
- **Description**: Updated to emphasize industrial CT / NDT applications
- **Features**: Changed "Medical 3D Viewing" → "3D CT Viewing"
- **Use Cases**: Added new section highlighting:
  - Industrial CT inspection
  - Quality control
  - Materials science
  - Additive manufacturing
  - Electronics inspection
  - Aerospace verification
- **Architecture**: Updated component names
- **Credits**: "medical imaging" → "CT imaging inspection"

### QUICKSTART.md
- Updated terminology throughout
- Changed "Medical 3D Volume" → "3D CT Volume"
- Added industrial CT use cases section
- Updated "medical mode" → "CT mode"

### CHANGELOG.md
- Added v1.1 section documenting the rebrand
- Listed all industrial CT use cases
- Maintained history of previous versions

## Application Focus

### Previous Focus
- Medical imaging (healthcare applications)
- Patient scans
- DICOM compatibility considerations

### New Focus
- **Industrial CT** (non-destructive testing)
- **Manufacturing quality control**
- **Component inspection**
- **Defect detection**
- **Dimensional analysis**
- **Materials research**

## Technical Functionality

**Note**: No technical functionality was changed. All features work exactly the same:
- ✅ 2D image viewing
- ✅ 3D volume rendering with orthogonal slices
- ✅ Synchronized zoom/pan
- ✅ Contrast/brightness controls
- ✅ RAW file format support
- ✅ Slice navigation
- ✅ All keyboard shortcuts
- ✅ Drag and drop

## Testing

To verify the changes work correctly:

1. Open `index.html` in browser
2. Verify title shows "Industrial CT Viewer"
3. Load test data from `test-data/` folder
4. Confirm 2x2 grid appears with CT volume
5. Test all controls (zoom, pan, contrast, brightness, slice navigation)
6. Check browser console for any errors

## Backward Compatibility

### Breaking Changes
None for end users. The viewer functions identically to before.

### For Developers
If you have external code referencing:
- `MedicalViewer` class → Update to `CTViewer`
- CSS classes with `.medical-*` → Update to `.ct-*`
- HTML IDs with `medical*` → Update to `ct*`

## Future Considerations

The rebrand to Industrial CT positions the viewer for:
- Industrial inspection workflows
- Manufacturing QA/QC processes
- NDT (Non-Destructive Testing) applications
- Materials science research
- Additive manufacturing quality control

While maintaining the possibility to add:
- DICOM support (if needed for medical cross-compatibility)
- Additional industrial-specific features
- Material-specific window/level presets
