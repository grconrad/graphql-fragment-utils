export const QUERY = `
query GetPhoto($photoId: ID!) {
  photo(id: $photoId) {
    id
    ...PhotoMetadata
    people {
      name
    }
  }
}

fragment PhotoMetadata on Photo {
  location
  date
  uri
  ...PhotoDimensions
  x {
    y {
      z
    }
  }
}

fragment PhotoDimensions on Photo {
  width
  height
}
`;
